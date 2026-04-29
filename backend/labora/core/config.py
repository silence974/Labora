"""
配置管理模块

支持从多个来源加载配置（优先级从高到低）：
1. 环境变量
2. 项目根目录的 .env 文件
3. ~/.config/labora/config.json
"""

import os
import json
from pathlib import Path
from typing import Optional, Dict, Any
from dotenv import load_dotenv

PDF_PREVIEW_MODES = {"auto", "compile", "remote", "disabled"}


def get_default_data_dir() -> str:
    """获取默认数据目录"""
    return str(Path.home() / ".config" / "labora" / "data")


class Config:
    """应用配置"""

    def __init__(self):
        # 1. 加载 JSON 配置文件（最低优先级）
        json_config = self._load_json_config()

        # 2. 加载 .env 文件（中等优先级）
        env_path = Path(__file__).parent.parent.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path)

        # 3. 环境变量优先级最高
        # OpenAI 配置
        self.openai_api_key: Optional[str] = (
            os.getenv("OPENAI_API_KEY")
            or json_config.get("openai_api_key")
        )
        self.openai_api_base: Optional[str] = (
            os.getenv("OPENAI_API_BASE")
            or json_config.get("openai_api_base")
        )
        self.openai_model: str = (
            os.getenv("OPENAI_MODEL")
            or json_config.get("openai_model")
            or "gpt-4o-mini"
        )

        # 数据存储配置
        default_data_dir = get_default_data_dir()
        self.data_dir: str = (
            os.getenv("LABORA_DATA_DIR")
            or json_config.get("data_dir")
            or default_data_dir
        )

        # 确保数据目录存在
        Path(self.data_dir).mkdir(parents=True, exist_ok=True)

        # 数据库路径（在数据目录下）
        self.db_path: str = (
            os.getenv("DB_PATH")
            or json_config.get("db_path")
            or str(Path(self.data_dir) / "labora.db")
        )

        # PDF 预览策略
        raw_pdf_preview_mode = (
            os.getenv("PDF_PREVIEW_MODE")
            or json_config.get("pdf_preview_mode")
            or "auto"
        )
        normalized_pdf_preview_mode = str(raw_pdf_preview_mode).strip().lower()
        self.pdf_preview_mode: str = (
            normalized_pdf_preview_mode
            if normalized_pdf_preview_mode in PDF_PREVIEW_MODES
            else "auto"
        )

    def _load_json_config(self) -> Dict[str, Any]:
        """从 ~/.config/labora/config.json 加载配置"""
        config_path = Path.home() / ".config" / "labora" / "config.json"

        if not config_path.exists():
            return {}

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: Failed to load config from {config_path}: {e}")
            return {}

    def validate(self) -> bool:
        """验证必需的配置项"""
        if not self.openai_api_key:
            return False
        return True

    def get_openai_kwargs(self) -> dict:
        """获取 OpenAI 初始化参数"""
        kwargs = {
            "model": self.openai_model,
            "api_key": self.openai_api_key,
        }
        if self.openai_api_base:
            kwargs["base_url"] = self.openai_api_base
        return kwargs


# 全局配置实例
config = Config()
