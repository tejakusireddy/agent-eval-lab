"""RAG agent implementation with simple in-memory retrieval."""

import os
import re
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

STOPWORDS = {
    "a",
    "about",
    "an",
    "and",
    "are",
    "can",
    "do",
    "does",
    "for",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "of",
    "on",
    "or",
    "tell",
    "the",
    "this",
    "to",
    "we",
    "what",
    "your",
}


class RAGAgent:
    """Simple RAG agent with in-memory document retrieval."""

    def __init__(
        self,
        documents_dir: Path,
        model: str = "gpt-4o-mini",
        temperature: float = 0.1,
        max_tokens: int = 512,
    ) -> None:
        """
        Initialize RAG agent.

        Args:
            documents_dir: Directory containing document files
            model: OpenAI model name
            temperature: Model temperature
            max_tokens: Maximum tokens in response
        """
        self.documents_dir = documents_dir
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.client: AsyncOpenAI | None = None
        self.offline_mode = False

        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.client = AsyncOpenAI(api_key=api_key)
        else:
            self.offline_mode = True

        # Load documents
        self.documents: list[dict[str, Any]] = []
        self._load_documents()

    def _load_documents(self) -> None:
        """Load all text/markdown files from documents directory."""
        if not self.documents_dir.exists():
            self.documents_dir.mkdir(parents=True, exist_ok=True)
            return

        # Resolve to absolute path and try multiple glob patterns
        doc_dir = self.documents_dir.resolve()
        patterns = ["*.txt", "*.md", "*.markdown"]
        file_paths = []
        for pattern in patterns:
            file_paths.extend(doc_dir.glob(pattern))
        
        # Remove duplicates (in case of overlap)
        file_paths = list(set(file_paths))
        
        for file_path in file_paths:
            try:
                with open(file_path, encoding="utf-8") as f:
                    content = f.read()
                    self.documents.append(
                        {
                            "filename": file_path.name,
                            "content": content,
                            "path": str(file_path),
                        }
                    )
            except Exception as e:
                print(f"Warning: Could not load {file_path}: {e}")

    def _tokenize(self, text: str) -> set[str]:
        """Extract normalized content words for lightweight retrieval."""
        return {
            token
            for token in re.findall(r"[a-z0-9]+", text.lower())
            if len(token) > 1 and token not in STOPWORDS
        }

    def _simple_retrieval(
        self, query: str, top_k: int = 3
    ) -> list[dict[str, Any]]:
        """
        Simple keyword-based retrieval.

        Args:
            query: User query
            top_k: Number of documents to retrieve

        Returns:
            List of document snippets with scores
        """
        if not self.documents:
            return []

        query_words = self._tokenize(query)
        if not query_words:
            return []

        scored_docs: list[tuple[float, dict[str, Any]]] = []
        minimum_overlap = 1 if len(query_words) <= 2 else 2

        for doc in self.documents:
            content_lower = doc["content"].lower()
            content_words = self._tokenize(content_lower)

            overlap = len(query_words & content_words)
            if overlap < minimum_overlap:
                continue

            score = overlap / len(query_words)

            for word in query_words:
                count = content_lower.count(word)
                score += count * 0.1

            scored_docs.append((score, doc))

        # Sort by score descending
        scored_docs.sort(key=lambda x: x[0], reverse=True)

        # Return top_k documents
        return [doc for _, doc in scored_docs[:top_k]]

    def _local_fallback_answer(
        self,
        user_query: str,
        retrieved_docs: list[dict[str, Any]],
    ) -> str:
        """Build a deterministic answer from retrieved documents."""
        if not retrieved_docs:
            return (
                "I don't have information about that in the provided knowledge base."
            )

        query_terms = self._tokenize(user_query)

        candidates: list[tuple[int, int, str]] = []
        for doc in retrieved_docs:
            lines = [line.strip() for line in doc["content"].splitlines()]
            for index, line in enumerate(lines):
                if not line:
                    continue
                if line.startswith("Q:"):
                    question = line[2:].strip()
                    answer = ""
                    if index + 1 < len(lines) and lines[index + 1].startswith("A:"):
                        answer = lines[index + 1][2:].strip()
                    candidate_text = answer or question
                    score_text = f"{question} {answer}".strip()
                    sentence_terms = set(
                        re.findall(r"[a-z0-9]+", score_text.lower())
                    )
                    overlap = len(query_terms & sentence_terms)
                    if overlap > 0 and candidate_text:
                        candidates.append((overlap, len(candidate_text), candidate_text))
                    continue
                if line.startswith("A:"):
                    continue

            for raw_sentence in re.split(r"(?<=[.!?])\s+|\n+", doc["content"]):
                sentence = raw_sentence.strip()
                if (
                    not sentence
                    or sentence.startswith("Q:")
                    or sentence.startswith("A:")
                    or sentence.startswith("#")
                ):
                    continue
                sentence_terms = set(re.findall(r"[a-z0-9]+", sentence.lower()))
                overlap = len(query_terms & sentence_terms)
                if overlap > 0:
                    candidates.append((overlap, len(sentence), sentence))

        candidates.sort(key=lambda item: (-item[0], item[1]))

        selected: list[str] = []
        seen = set()
        for _, _, sentence in candidates:
            if sentence in seen:
                continue
            seen.add(sentence)
            selected.append(sentence)
            if len(selected) == 3:
                break

        if not selected:
            filenames = ", ".join(doc["filename"] for doc in retrieved_docs)
            return (
                "I found relevant documents in the knowledge base "
                f"({filenames}), but I couldn't extract a precise answer."
            )

        summary = " ".join(selected)
        return f"Based on the knowledge base: {summary}"

    async def query(
        self, user_query: str
    ) -> dict[str, Any]:
        """
        Process a user query using RAG.

        Args:
            user_query: The user's question

        Returns:
            Dictionary with answer, context snippets, and metadata
        """
        # Retrieve relevant documents
        retrieved_docs = self._simple_retrieval(user_query, top_k=3)

        # Build context from retrieved documents
        context_snippets: list[str] = []
        used_docs: list[str] = []

        for doc in retrieved_docs:
            # Take first 500 chars of each document as snippet
            snippet = doc["content"][:500]
            if len(doc["content"]) > 500:
                snippet += "..."
            context_snippets.append(snippet)
            used_docs.append(doc["filename"])

        # Build prompt
        context_text = "\n\n".join(
            f"[Document: {doc['filename']}]\n{snippet}"
            for doc, snippet in zip(retrieved_docs, context_snippets)
        )

        system_message = (
            "You are a helpful support agent for this knowledge base. "
            "If information is not present in the provided context, "
            "explicitly say you don't know instead of guessing."
        )

        user_message = f"""Context from knowledge base:

{context_text if context_text else "[No relevant documents found]"}

User question: {user_query}"""

        if self.client is None:
            answer = self._local_fallback_answer(user_query, retrieved_docs)
            tokens_estimate = (
                len(system_message.split())
                + len(user_message.split())
                + len(answer.split())
            ) * 1.3
            return {
                "answer": answer,
                "context_snippets": context_snippets,
                "metadata": {
                    "model": self.model,
                    "mode": "offline_retrieval",
                    "used_docs": used_docs,
                    "tokens_estimate": int(tokens_estimate),
                },
            }

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": user_message},
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            )

            answer = response.choices[0].message.content or ""

            tokens_estimate = (
                len(system_message.split())
                + len(user_message.split())
                + len(answer.split())
            ) * 1.3

            return {
                "answer": answer,
                "context_snippets": context_snippets,
                "metadata": {
                    "model": self.model,
                    "mode": "openai",
                    "used_docs": used_docs,
                    "tokens_estimate": int(tokens_estimate),
                },
            }
        except Exception as e:
            raise RuntimeError(f"Error calling OpenAI: {e}") from e
