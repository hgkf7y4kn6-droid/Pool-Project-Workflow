# Pool PM agent service (CrewAI). Build from the repository root:
#   docker build -f services/crew/Dockerfile -t pool-crew services/crew
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    CREWAI_DISABLE_TELEMETRY=true CREWAI_TRACING_ENABLED=false OTEL_SDK_DISABLED=true
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pool_crew ./pool_crew
RUN useradd --create-home --uid 10001 crew
USER crew
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn --factory pool_crew.app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
