import asyncio
import websockets
import json

async def test_websocket():
    uri = "ws://127.0.0.1:8001/optimize-stream"
    
    try:
        async with websockets.connect(uri) as websocket:
            print("✓ Connected to WebSocket")
            
            # Send test data
            await websocket.send(json.dumps({
                "prompt": "test prompt",
                "skip_cache": False
            }))
            print("✓ Sent test prompt")
            
            # Receive response
            while True:
                message = await websocket.recv()
                data = json.loads(message)
                print(f"Received: {data.get('type')}")
                
                if data.get('type') == 'complete':
                    print(f"✓ Complete! Optimized text length: {len(data.get('optimized', ''))}")
                    break
                elif data.get('type') == 'error':
                    print(f"✗ Error: {data.get('message')}")
                    break
                    
    except Exception as e:
        print(f"✗ Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_websocket())
