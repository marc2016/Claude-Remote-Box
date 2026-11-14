# Agent for claude-remote-box: fetches every project and carries out the Git
# actions queued in the dashboard. The image only provides the tools; it runs
# the crb of the mounted installation directory (see services/crb-agent.yaml).
FROM debian:trixie-slim

LABEL org.opencontainers.image.source="https://github.com/marc2016/Claude-Remote-Box" \
      org.opencontainers.image.description="Git agent for claude-remote-box" \
      org.opencontainers.image.licenses="MIT"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash ca-certificates curl git libnss-wrapper openssh-client \
    && rm -rf /var/lib/apt/lists/*

# The service runs under the host user's UID, which owns the repositories but
# has no passwd entry here.
RUN git config --system --add safe.directory '*'

COPY entrypoint.sh /usr/local/bin/crb-agent-entrypoint
RUN chmod 0755 /usr/local/bin/crb-agent-entrypoint

ENV HOME=/agent
ENTRYPOINT ["/usr/local/bin/crb-agent-entrypoint"]
CMD ["./crb", "agent"]
