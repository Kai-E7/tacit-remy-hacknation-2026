FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PRESIDIO_HOST=0.0.0.0 PRESIDIO_PORT=5003
WORKDIR /app
COPY infra/presidio/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY infra/presidio/service.py ./service.py
RUN useradd --uid 1001 --create-home app
USER app
EXPOSE 5003
CMD ["python", "service.py"]
