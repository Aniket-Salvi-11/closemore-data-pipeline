import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_connection():
    return psycopg2.connect(
        host=os.getenv("POSTGRES_HOST"),
        port=int(os.getenv("POSTGRES_PORT")),
        dbname=os.getenv("POSTGRES_DB"),
        user=os.getenv("POSTGRES_USER"),
        password=os.getenv("POSTGRES_PASSWORD"),
        sslmode="disable",
    )


if __name__ == "__main__":
    try:
        connection = get_connection()
        print("✅ Connected to PostgreSQL successfully!")

        connection.close()
        print("✅ Connection closed.")

    except Exception as e:
        print("❌ Connection failed:")
        print(e)