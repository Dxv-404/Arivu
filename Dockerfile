FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-xlib-2.0-0  \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["gunicorn", "app:create_app()", "--workers", "2", "--bind", "0.0.0.0:8000", "--timeout", "120"]
