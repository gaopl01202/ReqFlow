FROM public.ecr.aws/docker/library/python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN groupadd --system reqflow \
    && useradd --system --gid reqflow --home-dir /app reqflow

WORKDIR /app
COPY requirements.lock ./requirements.lock
RUN awk -F '==' '$1 != "ruff" {print}' requirements.lock > /tmp/requirements-runtime.lock \
    && pip install --no-cache-dir --index-url https://mirrors.aliyun.com/pypi/simple/ -r /tmp/requirements-runtime.lock \
    && rm /tmp/requirements-runtime.lock
COPY backend ./backend
COPY scripts/volume_archive.py ./scripts/volume_archive.py
RUN mkdir -p /var/lib/reqflow/attachments \
    && chown -R reqflow:reqflow /app /var/lib/reqflow

USER reqflow
WORKDIR /app/backend
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "120"]
