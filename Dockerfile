FROM python:3.11-slim

# System libraries required by python-magic (libmagic1) and weasyprint
# (pango/cairo/gdk-pixbuf). Without these, pip install succeeds but
# import python_magic or import weasyprint will raise OSError at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["gunicorn", "app:create_app()", "--workers", "1", "--bind", "0.0.0.0:8000", "--timeout", "120"]
