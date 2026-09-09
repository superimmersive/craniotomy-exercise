"""Local static server with GLB MIME type for the anatomy viewer."""
import http.server
import socket
import sys

PORT = 5184
BIND = "0.0.0.0"


def lan_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("1.1.1.1", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.lower().endswith(".glb"):
            return "model/gltf-binary"
        if path.lower().endswith(".wav"):
            return "audio/wav"
        return super().guess_type(path)


if __name__ == "__main__":
    ip = lan_ip()
    print("Local  http://127.0.0.1:%s/" % PORT)
    print("LAN    http://%s:%s/" % (ip, PORT))
    sys.stdout.flush()
    http.server.test(HandlerClass=Handler, port=PORT, bind=BIND)
