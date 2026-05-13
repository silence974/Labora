import pytest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from labora.core import Config


class TestConfig:
    """测试配置管理"""

    def test_load_from_env(self, monkeypatch):
        """测试从环境变量加载"""
        monkeypatch.setenv("OPENAI_API_KEY", "test-key-from-env")
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4")

        config = Config()

        assert config.openai_api_key == "test-key-from-env"
        assert config.openai_model == "gpt-4"

    def test_load_from_json(self, monkeypatch, tmp_path):
        """测试从 JSON 配置文件加载"""
        # 创建临时配置文件
        config_dir = tmp_path / ".config" / "labora"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"

        config_data = {
            "openai_api_key": "test-key-from-json",
            "openai_model": "gpt-3.5-turbo",
        }

        with open(config_file, "w") as f:
            json.dump(config_data, f)

        # Mock Path.home() 返回临时目录
        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()

        assert config.openai_api_key == "test-key-from-json"
        assert config.openai_model == "gpt-3.5-turbo"

    def test_env_overrides_json(self, monkeypatch, tmp_path):
        """测试环境变量优先级高于 JSON"""
        # 创建 JSON 配置
        config_dir = tmp_path / ".config" / "labora"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"

        config_data = {
            "openai_api_key": "json-key",
            "openai_model": "gpt-3.5-turbo",
        }

        with open(config_file, "w") as f:
            json.dump(config_data, f)

        # 设置环境变量
        monkeypatch.setenv("OPENAI_API_KEY", "env-key")

        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()

        # 环境变量应该覆盖 JSON
        assert config.openai_api_key == "env-key"
        # JSON 中的其他配置仍然生效
        assert config.openai_model == "gpt-3.5-turbo"

    def test_default_values(self, monkeypatch, tmp_path):
        """测试默认值"""
        # 清除所有环境变量
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
        monkeypatch.delenv("OPENAI_API_BASE", raising=False)
        monkeypatch.delenv("LABORA_DATA_DIR", raising=False)
        monkeypatch.delenv("DB_PATH", raising=False)
        monkeypatch.delenv("LABORA_PROJECT_DIR", raising=False)
        monkeypatch.chdir(tmp_path)

        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()

        assert config.openai_model == "gpt-4o-mini"
        assert config.db_path.endswith("labora.db")
        assert config.data_dir == str(tmp_path.resolve() / ".labora")

    def test_project_dir_sets_default_storage(self, monkeypatch, tmp_path):
        """测试默认存储目录跟随用户项目目录"""
        monkeypatch.delenv("LABORA_DATA_DIR", raising=False)
        monkeypatch.delenv("DB_PATH", raising=False)
        monkeypatch.setenv("LABORA_PROJECT_DIR", str(tmp_path))

        config = Config()

        assert config.data_dir == str(tmp_path / ".labora")
        assert config.db_path == str(tmp_path / ".labora" / "labora.db")

    def test_validate(self, monkeypatch, tmp_path):
        """测试配置验证"""
        # 清除环境变量
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        # 没有 API key
        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()
        assert config.validate() is False

        # 有 API key
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()
        assert config.validate() is True

    def test_get_openai_kwargs(self, monkeypatch):
        """测试获取 OpenAI 参数"""
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        monkeypatch.setenv("OPENAI_MODEL", "gpt-4")
        monkeypatch.setenv("OPENAI_API_BASE", "https://custom.api.com")

        config = Config()
        kwargs = config.get_openai_kwargs()

        assert kwargs["api_key"] == "test-key"
        assert kwargs["model"] == "gpt-4"
        assert kwargs["base_url"] == "https://custom.api.com"

    def test_get_openai_kwargs_no_base_url(self, monkeypatch, tmp_path):
        """测试没有自定义 base_url"""
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        monkeypatch.delenv("OPENAI_API_BASE", raising=False)

        with patch("pathlib.Path.home", return_value=tmp_path):
            config = Config()
            kwargs = config.get_openai_kwargs()

        assert "base_url" not in kwargs or kwargs.get("base_url") is None

    def test_invalid_json_file(self, monkeypatch, tmp_path):
        """测试无效的 JSON 文件"""
        config_dir = tmp_path / ".config" / "labora"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"

        # 写入无效 JSON
        with open(config_file, "w") as f:
            f.write("invalid json {")

        with patch("pathlib.Path.home", return_value=tmp_path):
            # 应该不会崩溃，而是使用默认值
            config = Config()
            assert config.openai_model == "gpt-4o-mini"
