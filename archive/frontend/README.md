# Clearanswer Chat Companion

Build a clean, modern, responsive AI question-answering website.

The AI processing logic already exists in a separate Python/Java program. Do not create a new AI model or replace the existing logic. I want to connect the website to my existing backend through an API.

Core features:

Minimal, professional homepage.

Chat-style interface with a question input box.

Send button and Enter-to-submit functionality.

Display the user's question and the AI's response as separate chat messages.

Loading indicator while the response is being generated.

Clear conversation button.

Handle empty questions, network failures, and backend errors gracefully.

Responsive design for desktop and mobile.

Use clean, maintainable components.

Integration requirements:

Create a separate API service module so the backend URL can be configured later.

Assume the backend will expose a POST endpoint that accepts a question and returns a JSON response.

Use a placeholder API URL until I provide the actual endpoint and request/response format.

Keep API credentials and secrets out of frontend code.

Do not add authentication, payments, or a database in the initial version.

First build the frontend with mock responses so I can test the UI. Keep the code structured so I can connect my existing AI system afterward.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/7c53dec8-d927-4bab-b49f-c2ec3d634c1d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
