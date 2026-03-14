#!/usr/bin/env python3
"""
scripts/benchmark_nlp.py
Benchmarks the NLP worker encoding speed.
Phase 3 done-when criteria: 100 sentences encoded < 60s; 100x100 similarity matrix < 5s.
"""
import asyncio
import os
import time
import httpx

NLP_WORKER_URL = os.environ.get("NLP_WORKER_URL", "http://localhost:7860")
NLP_WORKER_API_KEY = os.environ.get("NLP_WORKER_SECRET", "")

SENTENCES = [
    f"This paper proposes a novel approach to machine learning problem number {i}. "
    f"We demonstrate improvements over baseline methods on standard benchmarks."
    for i in range(100)
]


async def bench_encode(sentences: list) -> float:
    headers = {"X-API-Key": NLP_WORKER_API_KEY} if NLP_WORKER_API_KEY else {}
    start = time.time()
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{NLP_WORKER_URL}/encode_batch",
            headers=headers,
            json={"texts": sentences},
        )
        resp.raise_for_status()
        data = resp.json()
    elapsed = time.time() - start
    assert "embeddings" in data, f"Response missing 'embeddings': {data}"
    assert len(data["embeddings"]) == len(sentences), "Wrong number of embeddings returned"
    return elapsed


async def bench_similarity_matrix(sentences_a: list, sentences_b: list) -> float:
    headers = {"X-API-Key": NLP_WORKER_API_KEY} if NLP_WORKER_API_KEY else {}
    start = time.time()
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            f"{NLP_WORKER_URL}/similarity_matrix",
            headers=headers,
            json={"texts_a": sentences_a, "texts_b": sentences_b},
        )
        resp.raise_for_status()
        data = resp.json()
    elapsed = time.time() - start
    assert "similarities" in data, f"Response missing 'similarities': {data}"
    return elapsed


async def main():
    print(f"NLP Worker: {NLP_WORKER_URL}")
    print()

    # Benchmark 1: encoding
    print("Benchmark 1: Encoding 100 sentences...")
    try:
        t = await bench_encode(SENTENCES)
        status = "PASS" if t < 60 else "FAIL (too slow)"
        print(f"  {t:.2f}s  {status}  (threshold: <60s)")
    except Exception as e:
        print(f"  FAIL: {e}")

    # Benchmark 2: similarity matrix
    print("\nBenchmark 2: Similarity matrix 100x100...")
    try:
        t = await bench_similarity_matrix(SENTENCES[:100], SENTENCES[:100])
        status = "PASS" if t < 5 else "FAIL (too slow)"
        print(f"  {t:.2f}s  {status}  (threshold: <5s)")
    except Exception as e:
        print(f"  FAIL: {e}")

    print("\nBenchmark complete.")


if __name__ == "__main__":
    asyncio.run(main())
