FROM node:20-alpine

WORKDIR /app

# Copiar archivos de definición de dependencias
COPY package*.json ./

# Instalar únicamente dependencias de producción
RUN npm ci --omit=dev

# Copiar el código fuente de la aplicación
COPY . .

# Exponer el puerto por defecto de la API
EXPOSE 3000

# Comando de arranque del servicio API
CMD ["node", "index.js"]
