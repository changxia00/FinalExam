FROM node:18-alpine
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
# 啟動應用
CMD ["node", "src/server.js"]