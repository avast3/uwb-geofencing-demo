from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .zones import router as zones_router

app = FastAPI(title="UWB Construction Safety Demo - Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(zones_router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
