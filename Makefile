# Path to the storage folder and database
STORAGE_DIR=server/storage
DB_PATH=$(STORAGE_DIR)/app.db

# Clean: remove all files in storage folder + remove app.db
clean:
	@echo "🧹 Cleaning up outputs..."
	@rm -rf $(STORAGE_DIR)/outputs/*
	@rm -rf $(STORAGE_DIR)/modified/*
	@rm -rf $(STORAGE_DIR)/originals/*
	@rm -f $(DB_PATH)
	@echo "Clean complete."

# Run: clean first, then start the server
run: clean
	@echo "Starting Flask app..."
	@python3 server/app.py