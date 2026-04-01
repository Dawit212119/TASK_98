FROM node:20-alpine

RUN apk add --no-cache postgresql-client

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

RUN addgroup -g 1001 -S appgroup && adduser -S appuser -u 1001 -G appgroup
RUN mkdir -p /usr/src/app/uploads && chown -R appuser:appgroup /usr/src/app/uploads
USER appuser

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "run", "start:prod"]
