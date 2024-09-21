# Use an official Node runtime as a parent image
FROM node:14

# Set the working directory in the container
WORKDIR /app

# Clone the repository
RUN git clone https://github.com/renjithsasidharan/deeplive-web-app.git .

# Install any needed packages specified in package.json
RUN npm install

# Build the app
RUN npm run build

# Install serve to run the application
RUN npm install -g serve

# Make port 3000 available to the world outside this container
EXPOSE 3000

# Run the app when the container launches
CMD ["serve", "-s", "build", "-l", "3000"]