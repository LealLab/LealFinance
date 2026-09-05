"""Aggregates all v1 routers under a single APIRouter."""

from fastapi import APIRouter

from app.api.v1 import (
    accounts,
    agents,
    auth,
    backups,
    budget_plan,
    budgets,
    card_invoices,
    categories,
    categorization_rules,
    category_groups,
    goals,
    health,
    institutions,
    investments,
    loans,
    manual_rates,
    market_data,
    meta,
    open_finance,
    recurring_rules,
    transactions,
)

api_v1_router = APIRouter(prefix="/api/v1")
api_v1_router.include_router(health.router)
api_v1_router.include_router(meta.router)
api_v1_router.include_router(auth.router)
api_v1_router.include_router(backups.router)
api_v1_router.include_router(agents.router)
api_v1_router.include_router(institutions.router)
api_v1_router.include_router(accounts.router)
api_v1_router.include_router(card_invoices.router)
api_v1_router.include_router(category_groups.router)
api_v1_router.include_router(categories.router)
api_v1_router.include_router(budgets.router)
api_v1_router.include_router(budget_plan.allocations_router)
api_v1_router.include_router(budget_plan.expected_income_router)
api_v1_router.include_router(transactions.router)
api_v1_router.include_router(recurring_rules.router)
api_v1_router.include_router(categorization_rules.router)
api_v1_router.include_router(manual_rates.router)
api_v1_router.include_router(goals.router)
api_v1_router.include_router(loans.router)
api_v1_router.include_router(investments.router)
api_v1_router.include_router(market_data.router)
api_v1_router.include_router(open_finance.router)
