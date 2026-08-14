"""Aggregates all v1 routers under a single APIRouter."""

from fastapi import APIRouter

from app.api.v1 import auth, health, meta

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health.router)
api_v1_router.include_router(meta.router)
api_v1_router.include_router(auth.router)
