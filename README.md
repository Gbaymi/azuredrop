AZUREDROP/
├── .github/
│   └── workflows/
│       └── deploy.yml          # Your CI/CD pipeline
├── backend/
│   ├── Dockerfile
│   ├── index.js                # Node.js API logic
│   ├── package.json
│   └── package-lock.json
├── nginx/
│   └── default.conf            # Reverse proxy configuration
├── public/
│   └── index.html              # The web interface
├── .env.example                # Safe environment variables template
├── .gitignore
├── docker-compose.yml          # Container orchestration
└── README.md                   # Documentation for your team