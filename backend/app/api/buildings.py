"""Read-only list of buildings, built from the uploaded CSV files."""
from fastapi import APIRouter, Header

from app.api.auth import _current_user
from app.services.building_service import all_buildings

router = APIRouter(prefix="/api/buildings", tags=["buildings"])


@router.get("")
def list_buildings(authorization: str | None = Header(default=None)):
    _current_user(authorization)
    return all_buildings()