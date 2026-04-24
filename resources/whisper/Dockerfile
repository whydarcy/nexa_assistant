# Dockerfile for building whisper_recognition.exe using PyInstaller
FROM python:3.10-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set workdir
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Install pyinstaller
RUN pip install pyinstaller

# Copy source code
COPY whisper_recognition.py .
COPY whisper_recognition.spec .

# Build exe
RUN pyinstaller whisper_recognition.spec

# Output location
CMD ["/bin/bash"]
