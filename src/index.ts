import { NgModule, Injectable } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsTabProvider } from 'tabby-settings';

import { UserDatabaseService } from './db.service';
import { UserManagerSettingsTabComponent } from './components/user-settings-tab.component';

// Settings Provider Registration (Must be Injectable and use getComponentType)
@Injectable()
class UserManagerSettingsProvider extends SettingsTabProvider {
  id = 'user-manager';
  icon = 'user';
  title = 'User Manager';

  getComponentType(): any {
    return UserManagerSettingsTabComponent;
  }
}

@NgModule({
  imports: [CommonModule, FormsModule],
  declarations: [UserManagerSettingsTabComponent],
  providers: [
    UserDatabaseService,
    {
      provide: SettingsTabProvider,
      useClass: UserManagerSettingsProvider,
      multi: true
    }
  ]
})
export default class UserManagerModule {}
