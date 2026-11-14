FROM public.ecr.aws/lambda/python:3.12

# System deps some pdfplumber/torch wheels or their transitive deps may need
RUN dnf install -y gcc gcc-c++ && dnf clean all

# Install Python deps first (better Docker layer caching -- these change
# far less often than the handler code)
COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Pre-download the embedding model at BUILD time so the container doesn't
# need internet egress or a slow first-invocation download at runtime.
#
# Set BOTH env vars: HF_HOME is what current huggingface_hub/sentence-
# transformers versions check first; SENTENCE_TRANSFORMERS_HOME is kept for
# older-version compatibility. Also disable HF's "check for updates" network
# calls entirely with HF_HUB_OFFLINE, since we NEVER want a runtime network
# fetch -- if the cache is ever missing/mismatched we want a clear local
# error, not a silent slow fallback to the internet.
ENV HF_HOME=/opt/model_cache
ENV SENTENCE_TRANSFORMERS_HOME=/opt/model_cache
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# From here on, force fully offline model loading -- confirms the cache
# above is actually sufficient (build fails loudly if it isn't) and
# guarantees the runtime Lambda never makes an HTTP call to huggingface.co.
ENV HF_HUB_OFFLINE=1
ENV TRANSFORMERS_OFFLINE=1
RUN python -c "from sentence_transformers import SentenceTransformer; m = SentenceTransformer('all-MiniLM-L6-v2'); print('OFFLINE LOAD OK:', m)"

# App code
COPY pipeline_core.py ${LAMBDA_TASK_ROOT}/pipeline_core.py
COPY lambda_handler.py ${LAMBDA_TASK_ROOT}/lambda_handler.py

CMD ["lambda_handler.handler"]