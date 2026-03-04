"""Configuration modules."""

# Import from the parent config.py module
import sys
from pathlib import Path

# Add parent directory to path to import config.py
_parent_dir = Path(__file__).parent.parent
if str(_parent_dir) not in sys.path:
    sys.path.insert(0, str(_parent_dir))

# Import from the legacy config.py file
import importlib.util
_config_path = _parent_dir / "config.py"
if _config_path.exists():
    spec = importlib.util.spec_from_file_location("legacy_config", _config_path)
    legacy_config = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(legacy_config)
    
    # Re-export classes
    OpenAIConfig = legacy_config.OpenAIConfig
    EvalConfig = legacy_config.EvalConfig
    AppConfig = legacy_config.AppConfig
    load_app_config = legacy_config.load_app_config
else:
    # Fallback if config.py doesn't exist
    OpenAIConfig = None
    EvalConfig = None
    AppConfig = None
    load_app_config = None

from agent_eval_lab.config.runner_config import RunnerConfig

__all__ = [
    "RunnerConfig",
    "OpenAIConfig",
    "EvalConfig",
    "AppConfig",
    "load_app_config",
]
