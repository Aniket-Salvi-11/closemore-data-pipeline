# CloseMore AI Copilot service. Secrets come from the environment at run time, never from this image.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
RUN useradd --create-home copilot && mkdir -p /app/logs && chown -R copilot /app
USER copilot
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
