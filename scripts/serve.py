import http.server
import socketserver
import urllib.parse
import os
import sys

PORT = 5173
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

ALLOWED_ROOT_FILES = {'index.html', 'frame-viewer.html', 'favicon.ico', 'robots.txt'}
ALLOWED_PREFIXES = ('src/', 'public/', 'assets/', 'frames/')
BLOCKED_EXPLICIT = {'package.json', 'package-lock.json', 'vite.config.js', 'PROGRESS.md'}

def _is_within_root(target_path, root_dir):
    try:
        real_target = os.path.realpath(target_path)
        real_root = os.path.realpath(root_dir)
        return real_target.startswith(real_root + os.sep) or real_target == real_root
    except Exception:
        return False

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
        # 1. Unquote & normalize path to defeat %2e%2e%2f and traversal attempts
        decoded_path = urllib.parse.unquote(path)
        url_path = urllib.parse.urlsplit(decoded_path).path
        clean_path = url_path.lstrip('/').replace('\\', '/')

        if not clean_path:
            return os.path.join(PROJECT_ROOT, 'index.html')

        # 2. Block dotfiles and hidden folders (.git, .env, .github, etc.)
        parts = clean_path.split('/')
        if any(p.startswith('.') for p in parts if p):
            return ""  # Invalid/blocked path

        # 3. Block sensitive internal files & scripts
        if clean_path in BLOCKED_EXPLICIT or clean_path.startswith(('scripts/', 'node_modules/')):
            return ""

        # 4. Strict whitelist: only allowed root files or allowed frontend directories
        is_allowed_root = clean_path in ALLOWED_ROOT_FILES
        is_allowed_prefix = any(clean_path.startswith(prefix) for prefix in ALLOWED_PREFIXES)
        if not (is_allowed_root or is_allowed_prefix):
            return ""

        # Check public/ directory for frames/ and assets/
        if clean_path.startswith(('frames/', 'assets/')) or clean_path in ('favicon.ico', 'robots.txt'):
            public_candidate = os.path.join(PROJECT_ROOT, 'public', clean_path)
            if os.path.exists(public_candidate) and _is_within_root(public_candidate, PROJECT_ROOT):
                return public_candidate

        # Otherwise look in project root with boundary check
        root_candidate = os.path.join(PROJECT_ROOT, clean_path)
        if not _is_within_root(root_candidate, PROJECT_ROOT):
            return ""

        if os.path.isdir(root_candidate):
            index_in_dir = os.path.join(root_candidate, 'index.html')
            if os.path.exists(index_in_dir) and _is_within_root(index_in_dir, PROJECT_ROOT):
                return index_in_dir
        return root_candidate

    def end_headers(self):
        # Strict HTTP security headers (wildcard CORS removed)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
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
