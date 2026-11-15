"""
Isolated test: does this IAM user have s3vectors:QueryVectors permission,
and does the S3 Vectors index actually return results?

Deliberately avoids Bedrock (currently throttled) -- uses the same local
sentence-transformers embedding model already proven to work from the
ingestion Lambda, so this test isolates the S3 Vectors permission alone.

Run:
    python test_s3vectors_query.py
"""

from sentence_transformers import SentenceTransformer
import boto3

VECTOR_BUCKET = "vector-s3-bucket"
INDEX_NAME = "closemore-docs"
EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
REGION = "ap-south-1"

TEST_QUESTION = "What does the CloseMore onboarding guide say about role-based access control?"


def main():
    print(f"Loading embedding model {EMBED_MODEL_NAME} ...")
    model = SentenceTransformer(EMBED_MODEL_NAME)

    print(f"Question: {TEST_QUESTION}\n")
    q_vector = model.encode([TEST_QUESTION], normalize_embeddings=True)[0].tolist()

    print("Querying S3 Vectors...")
    s3vectors = boto3.client("s3vectors", region_name=REGION)

    try:
        response = s3vectors.query_vectors(
            vectorBucketName=VECTOR_BUCKET,
            indexName=INDEX_NAME,
            queryVector={"float32": q_vector},
            topK=3,
            returnMetadata=True,
            returnDistance=True,
        )
    except Exception as e:
        print("\nFAILED to query S3 Vectors.")
        print(f"Error: {e}")
        return

    hits = response.get("vectors", [])
    print(f"\nSUCCESS -- {len(hits)} result(s):\n")
    for hit in hits:
        meta = hit.get("metadata", {})
        print(f"  distance={hit.get('distance'):.4f}  file={meta.get('source_file')}  page={meta.get('page')}")
        print(f"    {meta.get('text', '')[:150]}")
        print()


if __name__ == "__main__":
    main()
