
Unfortunately, it is not possible in GitHub to disable mail notifications from a specific user.
If you are subscribed to notifications for a repo with Garda Code Action, we recommend turning off notifications for PR comments, to avoid lengthy emails:


As an alternative, you can filter in your mail provider the notifications specifically from the Garda Code Action bot, [see how](https://www.quora.com/How-can-you-filter-emails-for-specific-people-in-Gmail#:~:text=On%20the%20Filters%20and%20Blocked,the%20body%20of%20the%20email).


Another option to reduce the mail overload, yet still receive notifications on Garda Code Action tools, is to disable the help collapsible section in Garda Code Action bot comments.
This can done by setting `enable_help_text=false` for the relevant tool in the configuration file.
For example, to disable the help text for the `pr_reviewer` tool, set:

```
[pr_reviewer]
enable_help_text = false
```
