FROM python:3.11-slim
WORKDIR /app
COPY nlp_worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY nlp_worker/app.py ./app.py
ENV PORT=7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
