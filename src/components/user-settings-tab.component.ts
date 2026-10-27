import { Component, OnInit } from '@angular/core';
import { UserDatabaseService } from '../db.service';
import { ConnectionUser } from '../models/user.model';

@Component({
  selector: 'user-manager-settings',
  template: `
    <div class="container mt-4">
      <h3>Embedded User Database Manager</h3>
      <p class="text-muted">Manage reusable credentials and apply them directly to your Tabby SSH profiles.</p>

      <div class="row">
        <!-- Form Section -->
        <div class="col-md-5">
          <div class="card bg-dark text-white p-3 mb-3">
            <h5>{{ editMode ? 'Edit User' : 'Add New User' }}</h5>
            
            <div class="form-group mb-2">
              <label>Profile Label / Alias</label>
              <input type="text" class="form-control" [(ngModel)]="currentUser.label" placeholder="e.g. Production Admin">
            </div>

            <div class="form-group mb-2">
              <label>Username</label>
              <input type="text" class="form-control" [(ngModel)]="currentUser.username" placeholder="root / ubuntu">
            </div>

            <div class="form-group mb-2">
              <label>Authentication Type</label>
              <select class="form-select" [(ngModel)]="currentUser.authType">
                <option value="password">Password</option>
                <option value="key">Private Key</option>
                <option value="agent">SSH Agent</option>
              </select>
            </div>

            <div class="form-group mb-2" *ngIf="currentUser.authType === 'password'">
              <label>Password</label>
              <input type="password" class="form-control" [(ngModel)]="currentUser.password">
            </div>

            <div class="form-group mb-2" *ngIf="currentUser.authType === 'key'">
              <label>Private Key File Path</label>
              <input type="text" class="form-control" [(ngModel)]="currentUser.privateKeyPath" placeholder="~/.ssh/id_rsa">
              <label class="mt-2">Passphrase (Optional)</label>
              <input type="password" class="form-control" [(ngModel)]="currentUser.passphrase">
            </div>

            <div class="mt-3">
              <button class="btn btn-primary me-2" (click)="saveUser()">Save User</button>
              <button class="btn btn-secondary" *ngIf="editMode" (click)="resetForm()">Cancel</button>
            </div>
          </div>

          <!-- Link User to SSH Profile Card -->
          <div class="card bg-dark text-white p-3">
            <h5>Link User to SSH Profile</h5>
            <p class="text-muted small">Apply a saved database user directly to an existing Tabby SSH profile.</p>

            <div class="form-group mb-2">
              <label>Select User</label>
              <select class="form-select" [(ngModel)]="selectedUserId">
                <option *ngFor="let u of users" [value]="u._id">{{ u.label }} ({{ u.username }})</option>
              </select>
            </div>

            <div class="form-group mb-2">
              <label>Select SSH Profile</label>
              <select class="form-select" [(ngModel)]="selectedProfileId">
                <option *ngFor="let p of sshProfiles" [value]="p.id">{{ p.name }}</option>
              </select>
            </div>

            <button class="btn btn-success mt-2" [disabled]="!selectedUserId || !selectedProfileId" (click)="linkUserToProfile()">
              Apply Credentials to Profile
            </button>
            <div class="text-success small mt-2" *ngIf="linkSuccessMessage">{{ linkSuccessMessage }}</div>
          </div>
        </div>

        <!-- User List Section -->
        <div class="col-md-7">
          <table class="table table-dark table-striped">
            <thead>
              <tr>
                <th>Label</th>
                <th>Username</th>
                <th>Auth Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of users">
                <td>{{ user.label }}</td>
                <td>{{ user.username }}</td>
                <td><span class="badge bg-info">{{ user.authType }}</span></td>
                <td>
                  <button class="btn btn-sm btn-outline-light me-1" (click)="editUser(user)">Edit</button>
                  <button class="btn btn-sm btn-outline-danger" (click)="deleteUser(user._id)">Delete</button>
                </td>
              </tr>
              <tr *ngIf="users.length === 0">
                <td colspan="4" class="text-center text-muted">No stored users in local DB.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class UserManagerSettingsTabComponent implements OnInit {
  users: ConnectionUser[] = [];
  sshProfiles: any[] = [];
  editMode = false;
  currentUser: Partial<ConnectionUser> = { authType: 'password' };
  
  selectedUserId: string = '';
  selectedProfileId: string = '';
  linkSuccessMessage: string = '';

  constructor(private userDb: UserDatabaseService) {}

  async ngOnInit() {
    await this.loadData();
  }

  async loadData() {
    this.users = await this.userDb.getAllUsers();
    this.sshProfiles = await this.userDb.getSSHProfiles();
  }

  async saveUser() {
    if (!this.currentUser.label || !this.currentUser.username) return;

    if (this.editMode && this.currentUser._id) {
      await this.userDb.updateUser(this.currentUser._id, this.currentUser);
    } else {
      await this.userDb.addUser(this.currentUser as any);
    }

    this.resetForm();
    await this.loadData();
  }

  editUser(user: ConnectionUser) {
    this.editMode = true;
    this.currentUser = { ...user };
  }

  async deleteUser(id?: string) {
    if (!id) return;
    await this.userDb.deleteUser(id);
    await this.loadData();
  }

  async linkUserToProfile() {
    if (!this.selectedUserId || !this.selectedProfileId) return;
    const user = await this.userDb.getUserById(this.selectedUserId);
    if (!user) return;

    await this.userDb.applyUserToProfile(this.selectedProfileId, user);
    this.linkSuccessMessage = `Successfully applied "${user.label}" credentials to profile!`;
    setTimeout(() => {
      this.linkSuccessMessage = '';
    }, 4000);
  }

  resetForm() {
    this.editMode = false;
    this.currentUser = { authType: 'password' };
  }
}
