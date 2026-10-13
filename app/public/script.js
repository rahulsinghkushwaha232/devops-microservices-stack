const userForm = document.querySelector('#user-form');
const orderForm = document.querySelector('#order-form');
const usersList = document.querySelector('#users-list');
const ordersList = document.querySelector('#orders-list');
const orderUser = document.querySelector('#order-user');
const notice = document.querySelector('#notice');

async function api(path, options) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options && options.headers) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showNotice(message, success = false) {
  notice.textContent = message;
  notice.classList.toggle('success', success);
}

function addRecord(list, title, detail) {
  const li = document.createElement('li');
  const heading = document.createElement('span');
  heading.className = 'record-title';
  heading.textContent = title;
  const description = document.createElement('span');
  description.className = 'record-detail';
  description.textContent = detail;
  li.append(heading, description);
  list.append(li);
}

async function loadUsers() {
  const users = await api('/api/users');
  usersList.replaceChildren();
  orderUser.replaceChildren();
  users.forEach((user) => {
    addRecord(usersList, user.name, `${user.email} · ${user.role}`);
    const option = document.createElement('option');
    option.value = user._id;
    option.textContent = user.name;
    orderUser.append(option);
  });
}

async function loadOrders() {
  const orders = await api('/api/orders');
  ordersList.replaceChildren();
  orders.forEach((order) => {
    addRecord(ordersList, `${order.item} × ${order.quantity}`,
      `${order.userName || order.user?.name || 'Unknown user'} · $${Number(order.price).toFixed(2)} · ${order.status}`);
  });
}

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(userForm));
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(data) });
    userForm.reset();
    await loadUsers();
    showNotice('User added.', true);
  } catch (error) {
    showNotice(error.message);
  }
});

orderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(orderForm));
  data.quantity = Number(data.quantity);
  data.price = Number(data.price);
  try {
    await api('/api/orders', { method: 'POST', body: JSON.stringify(data) });
    orderForm.reset();
    await loadOrders();
    showNotice('Order created.', true);
  } catch (error) {
    showNotice(error.message);
  }
});

Promise.all([loadUsers(), loadOrders()]).catch((error) => showNotice(error.message));
