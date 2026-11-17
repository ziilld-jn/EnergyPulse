from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.dataset import router as dataset_router
from app.api.auth import router as auth_router, ensure_default_user
from app.api.buildings import router as buildings_router

# Creates a starter admin only when this is a brand-new installation.
ensure_default_user()

app = FastAPI(title="EnergyPulse API", version="2.0.0")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://energypulse-1.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth_router)
app.include_router(dataset_router)
app.include_router(buildings_router)


@app.get("/")
def root():
    return {"message": "Welcome to EnergyPulse 2.0!", "status": "Backend is running"}


@app.get("/health")
def health_check():
    return {"status": "healthy", "application": "EnergyPulse"}