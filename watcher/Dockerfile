FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg inotify-tools \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir dashscope oss2 srt requests pyyaml redis

COPY worker.py /app/worker.py
COPY worker_impl.py /app/worker_impl.py
COPY web.py /app/web.py

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/worker.py"]
