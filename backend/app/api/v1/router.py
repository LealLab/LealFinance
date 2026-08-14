"""Aggregates all v1 routers under a single APIRouter."""

from fastapi import APIRouter

from app.api.v1 import (
    accounts,
    auth,
    budget_plan,
    budgets,
    categories,
    health,
    institutions,
    meta,
)

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health.router)
api_v1_router.include_router(meta.router)
api_v1_router.include_router(auth.router)
api_v1_router.include_router(institutions.router)
api_v1_router.include_router(accounts.router)
api_v1_router.include_router(categories.router)
api_v1_router.include_router(budgets.router)
api_v1_router.include_router(budget_plan.allocations_router)
api_v1_router.include_router(budget_plan.expected_income_router)
