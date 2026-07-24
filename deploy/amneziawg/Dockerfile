FROM public.ecr.aws/docker/library/golang:1.24.4-bookworm AS build

ARG AWG_GO_COMMIT=1cc94272ca8e9e223a5fe76382f5880f09d3c12d

WORKDIR /src

ADD https://github.com/amnezia-vpn/amneziawg-go/archive/${AWG_GO_COMMIT}.tar.gz /tmp/amneziawg-go.tar.gz

RUN tar --extract --gzip --file=/tmp/amneziawg-go.tar.gz --strip-components=1 \
    && go mod download \
    && go mod verify \
    && CGO_ENABLED=0 go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/amneziawg-go \
      .

FROM public.ecr.aws/docker/library/alpine:3.19

ARG AWG_TOOLS_RELEASE=1.0.20260618-2

RUN apk --no-cache add \
      bash \
      ca-certificates \
      iproute2 \
      iptables \
      unzip \
      wget \
    && wget \
      --output-document=/tmp/amneziawg-tools.zip \
      "https://github.com/amnezia-vpn/amneziawg-tools/releases/download/v${AWG_TOOLS_RELEASE}/alpine-3.19-amneziawg-tools.zip" \
    && unzip -j /tmp/amneziawg-tools.zip -d /usr/local/bin \
    && rm /tmp/amneziawg-tools.zip \
    && chmod 0755 /usr/local/bin/awg /usr/local/bin/awg-quick

COPY --from=build /out/amneziawg-go /usr/local/bin/amneziawg-go
COPY --chmod=0755 deploy/amneziawg/entrypoint.sh /usr/local/bin/amneziawg-entrypoint
COPY --chmod=0755 deploy/amneziawg/healthcheck.sh /usr/local/bin/amneziawg-healthcheck

ENTRYPOINT ["/usr/local/bin/amneziawg-entrypoint"]
