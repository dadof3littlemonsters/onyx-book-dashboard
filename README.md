# Onyx Book Dashboard

A comprehensive book request and management dashboard designed for Saltbox VPS environments. Integrates with Prowlarr, qBittorrent, Audiobookshelf, and Hardcover to provide a seamless book discovery, request, and fulfillment workflow.

## Features

- **Book Discovery**: Browse curated book categories (Romantasy, High Fantasy, Sci-Fi/Dystopian, Cozy) using live Hardcover API data
- **Search Integration**: Real-time search across Hardcover's extensive book database
- **Request System**: Users can request books as audiobooks or ebooks with automatic tracking
- **Admin Dashboard**: Complete request management with Prowlarr search and qBittorrent download integration
- **Library Integration**: Automatic detection of owned books via Audiobookshelf library scanning
- **Secure Authentication**: PIN-based admin authentication with signed cookie sessions
- **Docker Ready**: Full Docker and Docker Compose support for easy deployment
- **Image Proxy**: Secure image proxying to handle CORS and authentication issues

## Architecture

- **Frontend**: React 18 with React Router, Axios, and Lucide React icons
- **Backend**: Node.js/Express with CORS, Helmet security, and dotenv
- **Data Storage**: JSON file-based storage for requests and history
- **External Integrations**:
  - Hardcover API (book metadata)
  - Prowlarr (torrent search)
  - qBittorrent (torrent downloads)
  - Audiobookshelf (library management)

## Prerequisites

- Saltbox VPS or similar media server environment
- Running instances of:
  - Prowlarr (for torrent searching)
  - qBittorrent (for torrent downloads)
  - Audiobookshelf (for library management)
- Hardcover API token (from https://hardcover.app)
- Node.js 18+ and npm (for development)

## Installation

### Docker Compose (Recommended)

1. Clone or extract the Onyx dashboard to your desired location
2. Configure environment variables in `.env` (see Configuration section)
3. Run:
   ```bash
   docker-compose up -d
   ```
4. Access the dashboard at `http://localhost:3000` or your configured domain

### Manual Installation

1. Install dependencies:
   ```bash
   npm run install:all
   ```
2. Build the React frontend:
   ```bash
   npm run build
   ```
3. Start the server:
   ```bash
   npm start
   ```

For development:
```bash
npm run dev
```

## Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Saltbox Integration
PROWLARR_API_KEY=your_prowlarr_api_key
PROWLARR_URL=http://prowlarr:9696

QBIT_USER=your_qbit_username
QBIT_PASS=your_qbit_password
QBIT_URL=http://qbittorrent:8080

# App Configuration
ADMIN_PIN=1905
NODE_ENV=production
PORT=3000

# Audiobookshelf Integration
ABS_URL=http://audiobookshelf:80
ABS_API_KEY=your_audiobookshelf_api_key

# Hardcover Integration
HARDCOVER_TOKEN=your_hardcover_api_token
```

### Obtaining API Keys

1. **Prowlarr**: Access your Prowlarr instance → Settings → General → Copy API Key
2. **qBittorrent**: Use your existing qBittorrent credentials
3. **Audiobookshelf**: Create an API key in Settings → Users → API Keys
4. **Hardcover**: Obtain a token from https://hardcover.app account settings

## Usage

### User Flow

1. **Browse Books**: Visit the homepage to browse books by genre
2. **Search**: Use the search bar to find specific books
3. **Request Books**: Click on any book to request it as an audiobook or ebook
4. **Track Status**: View your request status (pending, approved, downloaded)

### Admin Flow

1. **Login**: Click the admin button and enter the PIN (default: 1905)
2. **Manage Requests**: View and process pending book requests
3. **Search Torrents**: Search Prowlarr for requested books
4. **Start Downloads**: Send selected torrents to qBittorrent
5. **View History**: Track all processed requests and downloads
6. **Library Management**: Scan and search your Audiobookshelf library

## API Endpoints

### Public Endpoints

- `GET /api/books/:category` - Get books by category (romantasy, fantasy, dystopian, cozy)
- `GET /api/search?q=query` - Search books via Hardcover API
- `POST /api/request/:id` - Submit a book request
- `GET /api/proxy-image?url=...` - Proxy images from trusted sources

### Admin Endpoints (Require Authentication)

- `POST /api/admin/login` - Authenticate with PIN
- `GET /api/admin/requests` - Get pending requests
- `POST /api/admin/search/:requestId` - Search Prowlarr for a request
- `POST /api/admin/download/:requestId` - Start torrent download
- `GET /api/admin/history` - Get request history
- `POST /api/admin/scan-library` - Scan Audiobookshelf library
- `GET /api/admin/library-stats` - Get library statistics
- `GET /api/admin/library-search` - Search library

### Metadata Endpoints

- `GET /api/metadata/:title/:author` - Get aggregated book metadata
- `POST /api/admin/clear-caches` - Clear metadata caches

### Audiobookshelf Endpoints

- `GET /api/abs/users` - Get Audiobookshelf users
- `GET /api/abs/test` - Test ABS connection
- `GET /api/abs/libraries` - Get ABS libraries

## Development

### Project Structure

```
/opt/onyx/
├── client/                 # React frontend
│   ├── public/
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── App.js         # Main app component
│   │   └── App.css        # Main styles
│   └── package.json
├── server/                 # Node.js backend
│   ├── services/          # External service integrations
│   ├── utils/             # Utility functions
│   └── index.js           # Main server file
├── data/                  # JSON data storage
├── docker-compose.yml     # Docker Compose configuration
├── Dockerfile             # Docker build configuration
├── package.json          # Root package.json
└── .env                  # Environment configuration
```

### Available Scripts

- `npm run dev` - Start development server (concurrently runs frontend and backend)
- `npm run server:dev` - Start backend development server with nodemon
- `npm run client:dev` - Start React development server
- `npm run build` - Build React frontend for production
- `npm start` - Start production server
- `npm run install:all` - Install both root and client dependencies

### Adding New Features

1. **New Book Categories**: Update `server/index.js` and `server/genre_discovery.js`
2. **Additional Services**: Create new service files in `server/services/`
3. **UI Components**: Add React components in `client/src/components/`
4. **API Endpoints**: Add routes in `server/index.js`

## Security Considerations

- Admin authentication uses signed cookies with configurable PIN
- Image proxy restricts domains to prevent open redirects
- Helmet.js implements Content Security Policy headers
- Environment variables for sensitive credentials
- CORS configured for proper origin control

## Troubleshooting

### Common Issues

1. **Hardcover API Errors**: Verify your `HARDCOVER_TOKEN` is valid
2. **Prowlarr/QBittorrent Connection**: Ensure services are running and accessible
3. **Image Loading Issues**: Check proxy logs for domain restrictions
4. **Admin Login Fails**: Verify `ADMIN_PIN` matches configured value

### Logs

Check Docker logs:
```bash
docker-compose logs -f onyx
```

Or server logs in the terminal output.

## License

This project is developed for personal use within Saltbox VPS environments. External distribution may require additional licensing considerations.

## Support

For issues and feature requests, please check the existing Saltbox community resources or create an issue in the appropriate repository.

---

**Note**: This dashboard is designed to work specifically with Saltbox VPS components. Modifications may be required for other environments.