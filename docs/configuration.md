# Labora 配置说明

Labora 支持多种方式配置 API 密钥和其他设置。配置优先级从高到低：

1. **环境变量**（最高优先级）
2. **项目根目录的 .env 文件**
3. **~/.config/labora/config.json**（最低优先级）

## 方式 1：使用 .env 文件（推荐用于开发）

在项目根目录创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的 API 密钥：

```bash
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o-mini
```

## 方式 2：使用 JSON 配置文件（推荐用于生产）

创建配置目录和文件：

```bash
mkdir -p ~/.config/labora
cp config.json.example ~/.config/labora/config.json
```

编辑 `~/.config/labora/config.json`：

```json
{
  "openai_api_key": "sk-your-api-key-here",
  "openai_model": "gpt-4o-mini",
  "openai_api_base": null,
  "db_path": null
}
```

## 方式 3：使用环境变量

直接在命令行设置：

```bash
export OPENAI_API_KEY=sk-your-api-key-here
export OPENAI_MODEL=gpt-4o-mini
```

或在启动时指定：

```bash
OPENAI_API_KEY=sk-xxx uv run python main.py
```

## 配置项说明

- `openai_api_key`: OpenAI API 密钥（必需）
- `openai_model`: 使用的模型，默认 `gpt-4o-mini`
- `openai_api_base`: 自定义 API 端点（可选，用于代理或自建服务）
- `db_path`: 数据库文件路径（可选，默认为 `data/labora.db`）

## 验证配置

运行测试验证配置是否正确：

```bash
cd backend
uv run pytest tests/core/test_config.py -v
```
