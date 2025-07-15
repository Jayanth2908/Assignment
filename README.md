# Simple E-commerce API

A simple Node.js + Express e-commerce API with JWT authentication, user roles, product management, cart, and order endpoints. Uses in-memory storage (no database required).

## Features
- User registration/login with JWT
- Roles: customer, admin
- Product CRUD (admin only for create/update/delete)
- Product listing with pagination and search
- Cart management (per user)
- Order creation from cart
- All endpoints protected as per role

## Setup

1. **Install dependencies:**
   ```sh
   npm install
   ```

2. **Start the server:**
   ```sh
   npm start
   ```
   The server runs on [http://localhost:3000](http://localhost:3000)

## API Endpoints

### Auth
- `POST /register` — `{ username, password, role }` (role: 'customer' or 'admin')
- `POST /login` — `{ username, password }` → `{ token }`

### Products
- `GET /products` — List products. Query: `page`, `limit`, `search`, `category`
- `GET /products/:id` — Get product by id
- `POST /products` — (admin only) Add product `{ name, category, price }`
- `PUT /products/:id` — (admin only) Update product
- `DELETE /products/:id` — (admin only) Delete product

### Cart (customer only)
- `GET /cart` — Get current user's cart
- `POST /cart` — Add item `{ productId, quantity }`
- `PUT /cart/:productId` — Update quantity `{ quantity }`
- `DELETE /cart/:productId` — Remove item

### Orders (customer only)
- `POST /orders` — Create order from cart
- `GET /orders` — List user's orders

## Usage Example

1. **Register:**
   ```sh
   curl -X POST http://localhost:3000/register -H "Content-Type: application/json" -d '{"username":"alice","password":"pass","role":"customer"}'
   ```
2. **Login:**
   ```sh
   curl -X POST http://localhost:3000/login -H "Content-Type: application/json" -d '{"username":"alice","password":"pass"}'
   ```
   Save the returned `token` for authenticated requests:
   ```sh
   export TOKEN=... # your JWT
   ```
3. **List products:**
   ```sh
   curl http://localhost:3000/products
   ```
4. **Add to cart:**
   ```sh
   curl -X POST http://localhost:3000/cart -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"productId":1,"quantity":2}'
   ```
5. **Create order:**
   ```sh
   curl -X POST http://localhost:3000/orders -H "Authorization: Bearer $TOKEN"
   ```

## Notes
- All data is lost when the server restarts (in-memory only).
- For admin actions, register/login as an admin user.
- You can extend this with a database or frontend as needed. 