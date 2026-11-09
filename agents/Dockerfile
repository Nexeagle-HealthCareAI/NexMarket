# NexMarket Agents — build context is this folder (docker build -f agents/Dockerfile agents)
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY nexagents ./nexagents
RUN useradd --system --uid 1001 agents && chown -R agents /app
USER agents
EXPOSE 5020
# Secrets (AGENTS_SECRET, GROQ_API_KEY, AGENTS_DATABASE_URL) come from --env-file at deploy time, never the image.
CMD ["sh", "-c", "uvicorn nexagents.app:app --host 127.0.0.1 --port ${AGENTS_PORT:-5020} --workers 1"]
