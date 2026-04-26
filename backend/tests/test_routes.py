"""API route tests for incentive metadata exposure."""
import asyncio
import httpx

from app.main import app
from app.database import SessionLocal, engine, Base
from app.models import Incentive, Treaty, MultilateralMember, DataUpdateProposal, DataChangeLog


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.query(MultilateralMember).delete()
    db.query(Treaty).delete()
    db.query(DataChangeLog).delete()
    db.query(DataUpdateProposal).delete()
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
    db.query(DataChangeLog).delete()
    db.query(DataUpdateProposal).delete()
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


def test_update_proposal_rejects_unknown_fields():
    async def _post():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post("/api/data/propose-update", json={
                "incentive_id": 1,
                "field_name": "__dict__",
                "new_value": "bad",
                "proposed_source_url": "https://example.com/source",
                "proposed_source_description": "Example source",
                "proposer_email": "producer@example.com",
            })

    response = asyncio.run(_post())

    assert response.status_code == 400


def test_review_proposal_requires_admin_token():
    db = SessionLocal()
    db.add(DataUpdateProposal(
        incentive_id=1,
        field_name="rebate_percent",
        old_value="",
        new_value="35%",
        proposed_source_url="https://example.com/source",
        proposed_source_description="Example source",
        proposer_email="producer@example.com",
        status="pending",
        created_at="2026-04-26T00:00:00",
    ))
    db.commit()
    proposal_id = db.query(DataUpdateProposal).first().id
    db.close()

    async def _post():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            return await client.post(f"/api/admin/update-proposals/{proposal_id}/review", json={
                "action": "approve",
                "notes": "Verified",
            })

    response = asyncio.run(_post())

    assert response.status_code in (401, 503)
