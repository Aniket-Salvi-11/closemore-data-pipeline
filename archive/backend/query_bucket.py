import boto3
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("all-MiniLM-L6-v2")

question = "What is included in the on-prem infrastructure proposal?"
q_vector = model.encode([question], normalize_embeddings=True)[0].tolist()

s3vectors = boto3.client("s3vectors")
response = s3vectors.query_vectors(
    vectorBucketName="vector-s3-bucket",
    indexName="closemore-docs",
    queryVector={"float32": q_vector},
    topK=3,
    returnMetadata=True,
    returnDistance=True,
)

print(f"Question: {question}\n")
for hit in response["vectors"]:
    print(f"distance={hit['distance']:.4f}  file={hit['metadata']['source_file']}  page={hit['metadata']['page']}")
    print(f"  {hit['metadata']['text']}")
    print()