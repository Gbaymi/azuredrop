# 1. Use an official, lightweight Node.js image as the base environment
FROM node:18-alpine

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Copy package setup files first
COPY package*.json ./

# 4. Install production dependencies
RUN npm install --production

# 5. Copy the rest of the backend application code
COPY . .

# 6. Expose port 5000 inside the container
EXPOSE 5000

# 7. Define the command to start the application
CMD ["npm", "start"]