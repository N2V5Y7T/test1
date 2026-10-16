import http.server
import socketserver
import urllib.parse
import os
import sys

PORT = 5173
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

class TheNinesDevHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.json': 'application/json',
        '.webp': 'image/webp',
        '.css': 'text/css',
        '.html': 'text/html; charset=utf-8',
        '.svg': 'image/svg+xml',
    }

    def translate_path(self, path):
        # Strip query strings and hash
        url_path = urllib.parse.urlsplit(path).path
        clean_path = url_path.lstrip('/')

        if not clean_path:
            return os.path.join(PROJECT_ROOT, 'index.html')

        # Check public/ directory for frames/ and assets/
        if clean_path.startswith(('frames/', 'assets/')) or clean_path in ('favicon.ico', 'robots.txt'):
            public_candidate = os.path.join(PROJECT_ROOT, 'public', clean_path)
            if os.path.exists(public_candidate):
                return public_candidate

        # Otherwise look in project root
        root_candidate = os.path.join(PROJECT_ROOT, clean_path)
        if os.path.isdir(root_candidate):
            index_in_dir = os.path.join(root_candidate, 'index.html')
            if os.path.exists(index_in_dir):
                return index_in_dir
        return root_candidate

    def end_headers(self):
        # Enable CORS and disable aggressive caching in dev
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Keep console clean; only log errors or non-200 if needed
        if args and len(args) > 1 and str(args[1]) not in ('200', '206', '304'):
            sys.stderr.write(f"[Server] {args[0]} - {args[1]}\n")

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('127.0.0.1', PORT), TheNinesDevHandler) as httpd:
        print(f"[The Nines Dev Server] Running at http://localhost:{PORT}/", flush=True)
        print(f"[The Nines Dev Server] Debug HUD: http://localhost:{PORT}/?debug=1", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
