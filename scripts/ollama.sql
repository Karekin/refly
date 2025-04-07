-- Provider: ollama
-- Default model: ollama/qwen2.5:7b
-- OPENAI_BASE_URL: http://host.docker.internal:11434
INSERT INTO "refly"."model_infos" ("name", "label", "provider", "tier", "enabled", "is_default", "context_limit", "max_output", "capabilities")
VALUES 
    ('qwen2.5:latest', 'Qwen 2.5 7B', 'Qwen', 't2', 't', 't', 131072, 8192, '{}'),
    ('gemma3:4b', 'Gemma 3 4B', 'Gemma', 't2', 't', 'f', 131072, 8192, '{"vision":true}')
