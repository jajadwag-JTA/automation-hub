FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /out/hub ./cmd/hub

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/hub /usr/local/bin/hub
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/hub"]
CMD ["serve", "--listen", "0.0.0.0:8080"]