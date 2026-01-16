#!/usr/bin/env python3
"""
Script to download Vosk English model for speech recognition.
"""
import os
import urllib.request
import zipfile
import shutil

MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip"
MODEL_NAME = "vosk-model-en-us-0.22"
MODEL_DIR = os.path.join(os.path.dirname(__file__), MODEL_NAME)

def download_file(url, dest_path):
    """Download a file with progress."""
    print(f"Downloading {url}...")
    print(f"Destination: {dest_path}")
    
    def show_progress(block_num, block_size, total_size):
        downloaded = block_num * block_size
        percent = min(downloaded * 100 / total_size, 100)
        print(f"\rProgress: {percent:.1f}%", end="", flush=True)
    
    urllib.request.urlretrieve(url, dest_path, show_progress)
    print("\nDownload complete!")

def extract_zip(zip_path, extract_to):
    """Extract zip file."""
    print(f"Extracting {zip_path}...")
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
    print("Extraction complete!")

def main():
    """Main function."""
    if os.path.exists(MODEL_DIR):
        print(f"Model already exists at: {MODEL_DIR}")
        response = input("Do you want to re-download? (y/n): ")
        if response.lower() != 'y':
            print("Skipping download.")
            return
        shutil.rmtree(MODEL_DIR)
    
    zip_path = os.path.join(os.path.dirname(__file__), f"{MODEL_NAME}.zip")
    
    try:
        # Download model
        download_file(MODEL_URL, zip_path)
        
        # Extract model
        extract_zip(zip_path, os.path.dirname(__file__))
        
        # Clean up zip file
        os.remove(zip_path)
        print(f"\nModel downloaded successfully to: {MODEL_DIR}")
        print("You can now use the transcription service!")
        
    except Exception as e:
        print(f"\nError: {e}")
        print("\nAlternative: Download manually from:")
        print("https://alphacephei.com/vosk/models")
        print(f"Extract to: {os.path.dirname(__file__)}")

if __name__ == "__main__":
    main()
