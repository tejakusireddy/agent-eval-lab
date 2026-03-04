"""RAG agent implementation with simple in-memory retrieval."""

import os
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI


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

        # Initialize OpenAI client
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY environment variable is required"
            )

        self.client = AsyncOpenAI(api_key=api_key)

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

        query_lower = query.lower()
        query_words = set(query_lower.split())

        scored_docs: list[tuple[float, dict[str, Any]]] = []

        for doc in self.documents:
            content_lower = doc["content"].lower()
            content_words = set(content_lower.split())

            # Simple keyword overlap score
            overlap = len(query_words & content_words)
            total_query_words = len(query_words)
            if total_query_words > 0:
                score = overlap / total_query_words
            else:
                score = 0.0

            # Boost score if query words appear multiple times
            for word in query_words:
                count = content_lower.count(word)
                score += count * 0.1

            if score > 0:
                scored_docs.append((score, doc))

        # Sort by score descending
        scored_docs.sort(key=lambda x: x[0], reverse=True)

        # Return top_k documents
        return [doc for _, doc in scored_docs[:top_k]]

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

        # Call OpenAI
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

            # Estimate tokens (rough approximation)
            tokens_estimate = (
                len(system_message.split())
                + len(user_message.split())
                + len(answer.split())
            ) * 1.3  # Rough token-to-word ratio

            return {
                "answer": answer,
                "context_snippets": context_snippets,
                "metadata": {
                    "model": self.model,
                    "used_docs": used_docs,
                    "tokens_estimate": int(tokens_estimate),
                },
            }

        except Exception as e:
            raise RuntimeError(f"Error calling OpenAI: {e}") from e

