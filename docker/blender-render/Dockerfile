FROM nvidia/cuda:12.1.0-base-ubuntu22.04
RUN apt-get update && apt-get install -y blender awscli python3
ENV BLENDER_PATH=/usr/bin/blender
COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
