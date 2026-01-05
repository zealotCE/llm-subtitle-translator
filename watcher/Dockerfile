FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg inotify-tools \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir dashscope oss2 srt requests pyyaml

COPY worker.py /app/worker.py

ENV PYTHONUNBUFFERED=1

CMD ["python", "/app/worker.py"]
