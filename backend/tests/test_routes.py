"""API route tests for incentive metadata exposure."""
import asyncio
import httpx

from app.main import app
from app.database import SessionLocal, engine, Base
from app.models import Incentive, Treaty, MultilateralMember


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.query(MultilateralMember).delete()
    db.query(Treaty).delete()
    db.query(Incentive).delete()
    db.add(Incentive(
        name="Selective Test Fund",
        country_code="GB",
        incentive_type="fund",
        selection_mode="selective",
        operator_type="foundation",
        application_status="rolling",
        application_note="Rolling submissions",
        typical_award_amount=150_000,
        typical_award_currency="GBP",
        source_url="https://example.com/selective",
        source_description="Selective test source",
    ))
    db.commit()
    db.close()


def teardown_function():
    db = SessionLocal()
    db.query(MultilateralMember).delete()
    db.query(Treaty).delete()
    db.query(Incentive).delete()
    db.commit()
    db.close()


def test_incentives_route_exposes_selective_metadata():
    async def _fetch():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.get("/api/incentives")

    response = asyncio.run(_fetch())

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    item = body[0]
    assert item["selection_mode"] == "selective"
    assert item["operator_type"] == "foundation"
    assert item["application_status"] == "rolling"
    assert item["application_note"] == "Rolling submissions"
    assert item["typical_award_amount"] == 150000
    assert item["typical_award_currency"] == "GBP"
