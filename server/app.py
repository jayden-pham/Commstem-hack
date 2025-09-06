from flask import Flask
from flask_cors import CORS
import os

from db import init_db
from routes.images import images_bp
from routes.conversations import conv_bp

def create_app():
    app = Flask(__name__)
    CORS(app)
    init_db()
    # routes
    app.register_blueprint(images_bp)
    app.register_blueprint(conv_bp)
    return app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)